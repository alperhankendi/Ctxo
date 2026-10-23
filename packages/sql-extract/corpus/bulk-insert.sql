BULK INSERT dbo.LoanImports FROM 'C:\imports\loans.csv' WITH (FIELDTERMINATOR = ',', FIRSTROW = 2);
BULK INSERT [Circulation].[HoldImports] FROM 'C:\imports\holds.csv';
BULK INSERT #FineStaging FROM 'C:\imports\fines.csv';
