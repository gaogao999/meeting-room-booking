BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[rooms] (
    [id] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(200) NOT NULL,
    [location] NVARCHAR(200),
    [capacity] INT,
    [description] NVARCHAR(max),
    [is_active] BIT NOT NULL CONSTRAINT [rooms_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [rooms_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [rooms_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [rooms_name_location_key] UNIQUE NONCLUSTERED ([name],[location])
);

-- CreateTable
CREATE TABLE [dbo].[bookings] (
    [id] INT NOT NULL IDENTITY(1,1),
    [room_id] INT NOT NULL,
    [department] NVARCHAR(60) NOT NULL,
    [reserver] NVARCHAR(80) NOT NULL,
    [purpose] NVARCHAR(max),
    [start_at] VARCHAR(16) NOT NULL,
    [end_at] VARCHAR(16) NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [bookings_status_df] DEFAULT 'confirmed',
    [created_by] NVARCHAR(80),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [bookings_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL,
    [cancelled_at] DATETIME2,
    [cancelled_device] VARCHAR(64),
    [device_id] VARCHAR(64),
    [created_ip] VARCHAR(64),
    CONSTRAINT [bookings_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [bookings_room_id_status_start_at_end_at_idx] ON [dbo].[bookings]([room_id], [status], [start_at], [end_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [bookings_status_start_at_idx] ON [dbo].[bookings]([status], [start_at]);

-- AddForeignKey
ALTER TABLE [dbo].[bookings] ADD CONSTRAINT [bookings_room_id_fkey] FOREIGN KEY ([room_id]) REFERENCES [dbo].[rooms]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

