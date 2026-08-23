<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use App\Http\Middleware\ShareUserData;
use App\Http\Middleware\RedirectIfDealer;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->web(append: [
            ShareUserData::class,
           // RedirectIfDealer::class,
        ])->validateCsrfTokens(except: [
            'stripe/webhook','chat' // <-- exclude this route
        ]);;
    
       
    })->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
    
