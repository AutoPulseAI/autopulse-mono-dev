<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\Auth;

class RedirectIfDealer
{
    public function handle($request, Closure $next, $guard = null)
    {
        
        if (!Auth::guard($guard)->check()) {
            // Redirect to a different login page based on the guard
            if ($guard === 'dealer') {
                return redirect()->route('dealer.login');
            } else {
                return redirect()->route('login');
            }
        }

        return $next($request);
    }
}
