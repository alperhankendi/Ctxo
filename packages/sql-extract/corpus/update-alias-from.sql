UPDATE l
SET l.ClosedAt = GETDATE()
FROM dbo.Loans AS l
JOIN dbo.Holds h ON h.LoanId = l.Id
