SELECT *
FROM [dbo].[Loans.Archive] AS a
JOIN dbo.Loans AS l ON l.Id = a.LoanId
