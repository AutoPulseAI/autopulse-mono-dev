<?php
 
namespace App\Http\Controllers\Admin;
 
use App\Models\Admin;
use Illuminate\View\View;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;

use Illuminate\Support\Str;
use App\Services\SnsService;
use App\Services\AuthService;
use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use Validator;
use App\Http\Controllers\Controller;
 
class AdminLoginController extends Controller
{
    protected $snsService;
    protected $authService;
    use ApiResponseTrait;
   
    public function __construct(SnsService $snsService, AuthService $authService)
    {
        $this->snsService = $snsService;
        $this->authService = $authService;
    }

     /**
     * Show the profile for a given user.
     */

    public function index()
    {
        if (Auth::guard('admin')->check()) {
            return redirect(route('admin.dashboard'));
        }
        return view('template.admin.login');
    }


     /**
     * Process the login form submission.
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\RedirectResponse
     */
    public function login(Request $request)
    {
        // Validate the login form data
        $credentials = $request->validate([
            'email' => 'required|email',
            'password' => 'required',
        ]);

        // Attempt to log in the admin using the provided credentials
        if (Auth::guard('admin')->attempt($credentials)) {
            // Authentication passed...
            $user = Auth::guard('admin')->user();
            
    
            return redirect()->route('admin.dashboard');
        }

        // Authentication failed...
        return back()->withErrors(['email' => 'Invalid credentials'])->withInput();
    }


    

    
   

}
