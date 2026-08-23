<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Models\Setting;
use App\Models\Fav;
use Illuminate\Support\Facades\View;
use App\Models\Ads;

class ViewServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap services.
     */
    public function boot(): void
    {
        $websetting = Setting::all();
        $setting =[];
        foreach($websetting as $key =>$value){
            $setting[$value['meta_key']] = $value['meta_value'];
        }
        
        View::composer('*', function ($view) use($setting) {
            $view->with('setting', $setting);
        });
        
    }
}
