<?php 

// app/Http/Middleware/ShareUserData.php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Support\Facades\View;

class ShareUserData
{
    public function handle($request, Closure $next)
    {
        
        return $next($request);
    }
}
