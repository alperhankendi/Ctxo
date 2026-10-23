DELETE dbo.Holds WHERE ExpiresAt < @now;
DELETE Lending.Reservations WHERE CancelledAt IS NOT NULL
