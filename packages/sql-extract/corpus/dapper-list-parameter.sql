SELECT * FROM dbo.Loans WHERE Id IN @ids
SELECT * FROM dbo.Holds WHERE LoanId IN@loanIds
