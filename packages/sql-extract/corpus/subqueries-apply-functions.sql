SELECT m.Id
FROM dbo.Members m
CROSS APPLY dbo.fn_LoanStats(m.Id) s
OUTER APPLY (SELECT TOP 1 * FROM dbo.Holds h WHERE h.MemberId = m.Id) x
WHERE m.Id IN (SELECT MemberId FROM dbo.Loans)
    AND TRIM(' ' FROM m.Name) <> ''
