<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Routing\Router;
use Laravel\Cashier\Cashier;
use App\Models\Dealer;
use Illuminate\Support\Facades\URL;
use App\Models\Page;
use App\Models\FormBuilder;
use App\Models\Forms;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(Router $router): void
    {
        //dd($this->app->environment('production'));
        if (!$this->app->environment('production')) {
            URL::forceScheme('https');
        }
        Cashier::useCustomerModel(Dealer::class);

       //URL::forceScheme('https');
       
        //$router->aliasMiddleware('auth.redirect', \App\Http\Middleware\RedirectIfDealer::class);
    }
}
