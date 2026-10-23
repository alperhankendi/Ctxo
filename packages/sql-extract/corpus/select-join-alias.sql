SELECT l.Id
FROM dbo.Loans l
INNER JOIN [dbo].[Members] AS m ON m.Id = l.MemberId
