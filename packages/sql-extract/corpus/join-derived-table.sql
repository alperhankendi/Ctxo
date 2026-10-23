SELECT m.Name, d.LoanCount
FROM dbo.Members AS m
JOIN (SELECT MemberId, COUNT(*) AS LoanCount FROM dbo.Loans GROUP BY MemberId) AS d ON d.MemberId = m.Id
