using CsharpSample.Models;
using CsharpSample.Services;

namespace CsharpSample.Jobs;

public class UserSyncJob : BaseSyncJob
{
    private readonly UserService _userService;

    public UserSyncJob(UserService userService) : base("UserSync")
    {
        _userService = userService;
    }

    public override async Task ExecuteAsync()
    {
        LogStart();

        var users = _userService.GetAll();
        foreach (var user in users)
        {
            var display = _userService.GetUserDisplay(user.Id);
            await Task.Delay(10); // simulate work
        }

        LogComplete();
    }
}
