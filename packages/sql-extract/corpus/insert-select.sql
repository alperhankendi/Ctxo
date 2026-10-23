INSERT INTO dbo.LoanArchive (Id)
SELECT Id FROM dbo.Loans WHERE ClosedAt IS NOT NULL
