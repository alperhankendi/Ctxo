TRUNCATE TABLE dbo.LoanStaging;
SELECT * INTO dbo.LoanSnapshot FROM dbo.Loans;
SELECT * INTO #tmp FROM dbo.Holds;
