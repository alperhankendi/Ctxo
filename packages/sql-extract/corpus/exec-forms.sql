DECLARE @rc int, @sql nvarchar(max), @p sysname;
EXEC dbo.usp_CloseLoan @id = 1;
EXECUTE usp_Audit;
EXEC @rc = [dbo].[usp_Notify];
EXEC (@sql);
EXEC @p;
EXECUTE AS USER = 'auditor';
REVERT;
