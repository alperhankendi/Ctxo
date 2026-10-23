SET NOCOUNT ON
UPDATE dbo.Loans SET ClosedAt = GETDATE() WHERE Id = @id
DELETE FROM dbo.Holds WHERE LoanId = @id
