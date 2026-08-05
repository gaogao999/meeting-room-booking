-- The rules the application has always enforced, now enforced by the database
-- as well.
--
-- This mattered less when the data was a private SQLite file the app alone
-- opened. It is a shared SQL Server instance now: IT can query it, tools can be
-- pointed at it, and Prisma Studio edits rows directly. Anything writing around
-- the application should not be able to leave a booking the schedule cannot
-- draw, or two people in the same room at the same time.
--
-- Note there is no GO in this file. Prisma sends a migration as one batch and
-- GO is a sqlcmd separator, not T-SQL; the trigger is created through
-- sp_executesql instead, which is how CREATE TRIGGER gets the fresh batch it
-- insists on.

BEGIN TRY

BEGIN TRAN;

-- Who cancelled, and when.
ALTER TABLE [dbo].[bookings] ADD [cancelled_at] DATETIME2 NULL;
ALTER TABLE [dbo].[bookings] ADD [cancelled_device] VARCHAR(64) NULL;

-- Last change of any kind. Rows that predate this column get the time the
-- migration ran, which is the closest true statement available for them.
ALTER TABLE [dbo].[bookings] ADD [updated_at] DATETIME2 NOT NULL
  CONSTRAINT [bookings_updated_at_df] DEFAULT CURRENT_TIMESTAMP;

-- A booking has to end after it starts. Both columns are the same fixed-width
-- format, so comparing them as text compares them as time.
ALTER TABLE [dbo].[bookings] WITH CHECK
  ADD CONSTRAINT [bookings_end_after_start] CHECK ([end_at] > [start_at]);

-- Only the two statuses the application knows about. A third value would be
-- invisible to the schedule and counted by nothing.
ALTER TABLE [dbo].[bookings] WITH CHECK
  ADD CONSTRAINT [bookings_status_known] CHECK ([status] IN ('confirmed', 'cancelled'));

-- "YYYY-MM-DDTHH:MM" and nothing else. Every range query and every sort in the
-- app compares these as strings, which is only correct while the format holds.
ALTER TABLE [dbo].[bookings] WITH CHECK
  ADD CONSTRAINT [bookings_start_at_format] CHECK
  ([start_at] LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]');

ALTER TABLE [dbo].[bookings] WITH CHECK
  ADD CONSTRAINT [bookings_end_at_format] CHECK
  ([end_at] LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]');

-- No two confirmed bookings may overlap in the same room.
--
-- A CHECK constraint cannot see other rows and no unique index can express
-- "these ranges must not intersect", so this is a trigger. The application
-- already prevents it under a per-room lock; this is the same rule applied to
-- everything that does not go through the application.
--
-- Half-open interval [start, end): a booking ending at 10:00 and one starting
-- at 10:00 do not overlap, which is why both comparisons are strict.
EXEC sp_executesql N'
CREATE TRIGGER [dbo].[bookings_no_overlap]
ON [dbo].[bookings]
AFTER INSERT, UPDATE
AS
BEGIN
  SET NOCOUNT ON;

  IF EXISTS (
    SELECT 1
    FROM inserted AS i
    JOIN [dbo].[bookings] AS b
      ON b.room_id = i.room_id
     AND b.id <> i.id
     AND b.status = ''confirmed''
     AND b.start_at < i.end_at
     AND b.end_at > i.start_at
    WHERE i.status = ''confirmed''
  )
  BEGIN
    THROW 51001, ''This room is already booked for part of that time.'', 1;
  END
END';

COMMIT TRAN;

END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW
END CATCH
