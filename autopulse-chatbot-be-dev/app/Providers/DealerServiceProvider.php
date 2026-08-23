<?php 
namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\View;

class DealerServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     *
     * @return void
     */
    public function register()
    {
        //
    }

    /**
     * Bootstrap services.
     *
     * @return void
     */
    public function boot()
    {
        if ($this->app->bound('authenticatedDealer')) {
            $authenticatedDealer = $this->app->make('authenticatedDealer');
            $storeList = $this->app->make('storeList');
            $parentId = $this->app->make('parentId');

            View::share('authenticatedDealer', $authenticatedDealer);
            View::share('storeList', $storeList);
            View::share('parentId', $parentId);
        }
    }
}
