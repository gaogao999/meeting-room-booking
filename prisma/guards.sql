-- The rules the application enforces, enforced by the database as well.
--
-- Kept out of prisma/migrations and applied by scripts/apply-guards.js instead,
-- because Prisma reaches a database by two different roads and both have to end
-- here. `prisma migrate deploy` runs the migrations; `prisma db push` builds the
-- tables straight from schema.prisma and never looks at a migration. IT's
-- runbook uses push. Rather than argue with the runbook, npm run db:deploy and
-- npm run db:push both finish by running this file.
--
-- Which means it is run repeatedly, so every statement checks first and does
-- nothing when the object is already there.
--
-- Prisma's schema language cannot express any of this: it describes what the
-- generated client needs to know — tables, columns, relations, indexes — and a
-- CHECK constraint or a trigger is something it would create and then never
-- use. Trigger syntax also differs completely between the databases Prisma
-- supports, so a portable way to write one would have to be SQL.

-- A booking has to end after it starts. Both columns are the same fixed-width
-- format, so comparing them as text compares them as time.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'bookings_end_after_start')
  ALTER TABLE [dbo].[bookings] WITH CHECK
    ADD CONSTRAINT [bookings_end_after_start] CHECK ([end_at] > [start_at]);

-- Only the two statuses the application knows about. A third value would be
-- invisible to the schedule and counted by nothing.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'bookings_status_known')
  ALTER TABLE [dbo].[bookings] WITH CHECK
    ADD CONSTRAINT [bookings_status_known] CHECK ([status] IN ('confirmed', 'cancelled'));

-- "YYYY-MM-DDTHH:MM" and nothing else. Every range query and every sort in the
-- app compares these as strings, which is only correct while the format holds.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'bookings_start_at_format')
  ALTER TABLE [dbo].[bookings] WITH CHECK
    ADD CONSTRAINT [bookings_start_at_format] CHECK
    ([start_at] LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]');

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'bookings_end_at_format')
  ALTER TABLE [dbo].[bookings] WITH CHECK
    ADD CONSTRAINT [bookings_end_at_format] CHECK
    ([end_at] LIKE '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]');

-- Anything writing SQL directly fails on updated_at unless the column has a
-- default, because it has no reason to know about a column Prisma fills from
-- the client side. The schema now declares `@default(now())`, so both
-- `db push` and `migrate deploy` create one — but a database built before that
-- has the column with no default at all, and this is what repairs it.
--
-- Checked by column rather than by name: SQL Server allows a column only one
-- default, and the one Prisma creates carries Prisma's name, not ours. Looking
-- for our name would find nothing and then fail trying to add a second.
IF NOT EXISTS (
  SELECT 1 FROM sys.default_constraints d
  JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
  WHERE d.parent_object_id = OBJECT_ID('dbo.bookings') AND c.name = 'updated_at'
)
  ALTER TABLE [dbo].[bookings]
    ADD CONSTRAINT [bookings_updated_at_df] DEFAULT CURRENT_TIMESTAMP FOR [updated_at];

-- No two confirmed bookings may overlap in the same room.
--
-- A CHECK constraint cannot see other rows and no unique index expresses "these
-- ranges must not intersect", so this is a trigger. The application already
-- prevents it under a per-room lock; this is the same rule for everything that
-- does not go through the application.
--
-- Half-open interval [start, end): a booking ending at 10:00 and one starting
-- at 10:00 do not overlap, which is why both comparisons are strict.
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'bookings_no_overlap')
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
