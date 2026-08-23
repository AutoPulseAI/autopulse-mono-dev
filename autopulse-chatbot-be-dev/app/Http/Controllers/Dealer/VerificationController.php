<?php

namespace App\Http\Controllers\Dealer;

use Illuminate\Foundation\Auth\VerifiesEmails;
use Illuminate\Http\Request;
use Illuminate\Auth\Events\Verified;
use Illuminate\Auth\Access\AuthorizationException;
use App\Http\Controllers\Controller;
use App\Models\Dealer;
use App\Models\DealerSource;
use App\Models\Lead;
use App\Models\Visit;
use App\Services\AuthService;
use App\Jobs\SendDealerWelcomeEmailJob;

class VerificationController extends Controller
{
    //use VerifiesEmails;
    protected $authService;
    /**
     * Where to redirect users after verification.
     *
     * @var string
     */
    public function __construct( AuthService $authService)
    {
        
        $this->authService = $authService;
    }

    protected $redirectTo = '/dealer'; // Adjust this as needed

   

    public function verify(Request $request)
    {
        $userID = $request->route('id');
        $user = Dealer::findOrFail($userID);

        if ($user->markEmailAsVerified()) {
            $source = $user->source; 
            Lead::where('dealer_source', $source)->update(['dealer_id' => $user->id]);
            DealerSource::where('source', $source)->update(['dealer_id' => $user->id]);
            Visit::where('source', $source)->update(['dealer_id' => $user->id]);
            SendDealerWelcomeEmailJob::dispatch($user);
            
        }
        $this->authService->loginUser($user, 'dealer');

        return redirect()->route('dealer.profile')->with('verified', true);
    }


    protected function redirectPath()
    {
        return $this->redirectTo;
    }
}
