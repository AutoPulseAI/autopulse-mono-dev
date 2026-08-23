<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Models\Dealer;
use App\Models\DealerSource;
use App\Models\AssignDealer;

class checkStoreCount
{
    public function handle(Request $request, Closure $next)
    {
        $user = Auth::guard('dealer')->user(); 
       
        if ($user) {
           
            $mainDealer = $user;
            $storeList = $user->storeList()->get();
            $parentId = $user->id;
            #dd( $storeList);
            if ($user->storeList()->count() == 0) {
                return redirect(route('dealer.chat.index'))->with('error', 'This Feature is currently unavailable. Please configure your chatbot settings below to access all Feature.');
            }
        

        }

        return $next($request);
    }
}
