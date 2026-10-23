UPDATE dbo.Loans
SET ClosedAt = GETDATE()
OUTPUT inserted.Id INTO dbo.LoanAudit (Id)
WHERE Id = @id;
DELETE FROM dbo.Holds
OUTPUT deleted.Id INTO @gone (Id);
