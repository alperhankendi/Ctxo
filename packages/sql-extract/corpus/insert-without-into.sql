INSERT dbo.LoanEvents (LoanId, Kind)
SELECT Id, 'closed' FROM dbo.Loans WHERE ClosedAt IS NOT NULL;
INSERT Fines (LoanId, Amount) VALUES (@id, 1.50)
