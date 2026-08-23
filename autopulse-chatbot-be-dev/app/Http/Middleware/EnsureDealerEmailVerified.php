<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Models\Dealer;
use App\Models\DealerSource;
use App\Models\AssignDealer;
use Illuminate\Support\Facades\View;

class EnsureDealerEmailVerified
{
    public function handle(Request $request, Closure $next)
    {
        $user = Auth::guard('dealer')->user(); 
        if ($user) {
           
                $mainDealer = $user;
                $storeList = $user->storeList()->get();
                $parentId = $user->id;

                if (!$mainDealer->email_verified_at) {
                    return redirect(route('dealer.profile'))->with('error', 'Your email address is not verified.');
                }
               

                app()->instance('mainDealer', $mainDealer);
                app()->instance('storeList', $storeList);
                app()->instance('parentId', $parentId);
           
                View::share('mainDealer', $mainDealer);
                View::share('totalstorelist', $storeList->count());
                View::share('storeList', $storeList);
                View::share('parentId', $parentId);
           
        }

        return $next($request);
    }
}
