<?php
 
namespace App\Http\Controllers;
 
use App\Models\User;
use Illuminate\View\View;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;
use App\Models\SocialAccount;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use App\Services\SnsService;
use App\Services\AuthService;
use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use Validator;
use Illuminate\Support\Facades\Log;
use App\Jobs\SendWelcomeEmailJob;

class LoginController extends Controller
{
    protected $snsService;
    protected $authService;
    use ApiResponseTrait;
    /**
     * Show the profile for a given user.
     */
    public function __construct(SnsService $snsService, AuthService $authService)
    {
        $this->snsService = $snsService;
        $this->authService = $authService;
    }

    public function redirectToProvider(String $provider){
        session(['url.intended' => url()->previous()]);
        if($provider=='linkedin-openid')
            return \Socialite::driver($provider) ->scopes(['w_member_social', 'openid', 'profile', 'email'])->redirect();
        return \Socialite::driver($provider)->redirect();
    }

    public function verify(Request $request)
    {
        $userID = $request->route('id');
        $user = User::findOrFail($userID);

        $user->markEmailAsVerified();
        SendWelcomeEmailJob::dispatch($user);
        $this->authService->loginUser($user, '');
        //session(['url.intended' => url()->previous()]);
        $intendedUrl = session('url.intended', '/dashboard'); // Default to '/' if no intended URL

        // Redirect to the intended URL
        return redirect()->intended($intendedUrl);
        //return redirect()->route('dashboard')->with('verified', true);
    }

    public function providerCallback(String $provider){
        try{
            if($provider=='linkedin'){
                $provider ='linkedin-openid';
            }
            $social_user = \Socialite::driver($provider)->user();
           //dd($social_user);
            // First Find Social Account
            $account = SocialAccount::where([
                'provider_name'=>$provider,
                'provider_id'=>$social_user->getId()
            ])->first();
            $user = User::where([
                'email'=>$social_user->getEmail()
            ])->first();

            if(!$user){
                $user = User::create([
                    'email'=>$social_user->getEmail(),
                    'name'=>$social_user->getName(),
                    'phone_number'=>'',
                    'status'=>1,
                    'email_verified_at' =>now(),
                    'social_account'=>true
                ]);
                SendWelcomeEmailJob::dispatch($user);
            }else{
               
                $user->update([
                    'email'=>$social_user->getEmail(),
                    'name'=>$social_user->getName(),
                    'status'=>1,
                    'email_verified_at' =>now(),
                    'social_account'=>true
                   
                ]);
            }

            // Create Social Accounts
            $user->socialAccounts()->create([
                'provider_id'=>$social_user->getId(),
                'provider_name'=>$provider
            ]);

            // Login
            $this->authService->loginUser($user);
            $intendedUrl = session('url.intended', '/dashboard'); // Default to '/' if no intended URL

            // Redirect to the intended URL
            return redirect()->intended($intendedUrl);
            return redirect()->route('dashboard');

        }catch(\Exception $e){
           
            Log::debug($e);
            return redirect()->route('home');
        }
    }  

    public function index()
    {
        if(auth()->user()){
            return redirect(route('dashboard'));
        }
        return view('template.users.login');
    }


    /**
     * Send OTP to the user's phone number via Amazon SNS.
     *
     * Accepts: HTTP POST request with 'phone_number' field.
     * Returns: JSON response indicating success or failure.
     */
    public function sendOtp(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'phone_number' => 'required|digits:10|numeric',
            
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }
        
        $otp = rand(100000, 999999);

        Session::put('otp_' . $request->phone_number, $otp);

        // Send OTP to user via Amazon SNS
        $success = $this->snsService->sendOTP($request->dial_code.$request->phone_number, $otp);
        //$success = $this->snsService->sendVerificationCode($request->dial_code.$request->phone_number);

        if ($success) {
            return $this->respondWithSuccess('OTP sent successfully',[$otp],Response::HTTP_OK);
           
        } else {
            return $this->respondWithError('Wrong Phone Number',[],Response::HTTP_OK);
        }
    }

    public function userRegister(Request $request)
    {

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            
            'email' => 'required|string|email|max:255|unique:users',
            'password' => 'required|string|min:8|same:confirm_password',
            'confirm_password' => 'required|string|min:8', // Add this line
            'phone_number' => 'required|numeric|digits:10|unique:users',
               
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }
       

        $user = User::create([
            'name' => $request->name,
           
            'email' => $request->email,
            'phone_number' => $request->phone_number,
            'password' => Hash::make($request->password),
        ]);
        session(['url.intended' => url()->previous()]);

        $user->sendEmailVerificationNotification();

        //Auth::login($user);

        return $this->respondWithSuccess('User registered successfully. Please verify your email.', $user, Response::HTTP_OK);
    }

    public function userLogin(Request $request)
    {
       
        $validator = Validator::make($request->all(), [
            'email' => 'required|string|email',
            'password' => 'required|string',
               
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }

        $credentials = $request->only('email', 'password');
        try{
            if (Auth::attempt($credentials)) {
                $user = Auth::user();
            # dd(($user->email_verified_at));
            
            
                $user->update(['social_account'=>false]);
                if (is_null($user->email_verified_at)) {
                    // Send verification email
                    $user->sendEmailVerificationNotification();
                    session(['url.intended' => url()->previous()]);
                    // Log the user out
                    Auth::logout();
                
                    return $this->respondWithSuccess('Email not verified. Verification link sent to your email.', [], Response::HTTP_OK);
                }
                return $this->respondWithSuccess('User login successfully', $user, Response::HTTP_OK);
            }
        }
        catch (\Exception $e) {
            return $this->respondWithError('Invalid email or password', [], Response::HTTP_OK);
        }

        return $this->respondWithError('Invalid email or password', [], Response::HTTP_OK);
    }

    public function forgotPassword(Request $request)
    {
        $request->validate(['email' => 'required|email']);

        $user = User::where('email', $request->email)->first();
        
        if (is_null($user)) {
            return $this->respondWithError('User does not exist', [], Response::HTTP_BAD_REQUEST);
        }

        $token = Password::broker('users')->createToken($user);

        $user->sendPasswordResetNotification($token);

        return $this->respondWithSuccess('Password reset link sent', [], Response::HTTP_OK);
    }

    public function resetPassword(Request $request)
    {
       
        $validator = Validator::make($request->all(), [
            'token' => 'required',
            'email' => 'required|email',
            'password' => 'required|string|min:8|same:confirm_password',
            'confirm_password' => 'required|string|min:8', // Add this line
               
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }

        $status = Password::broker('users')->reset(
            $request->only('email', 'password', 'token'),
            function ($user, $password) {
                $user->forceFill([
                    'password' => Hash::make($password)
                ])->save();

                $user->setRememberToken(Str::random(60));

                Auth::login($user);
            }
        );

        if ($status == Password::PASSWORD_RESET) {
            return $this->respondWithSuccess('Password reset successfully', [], Response::HTTP_OK);
        }

        return $this->respondWithError('Unable to reset password', [], Response::HTTP_OK);
    }

    public function changePassword(Request $request)
    {
       

        $validator = Validator::make($request->all(), [
           'current_password' => 'required|string',
            'new_password' => 'required|string|min:8|same:new_confirm_password',
            'new_confirm_password' => 'required|string|min:8', // Add this line
           
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }

        $user = Auth::user();

        if (!Hash::check($request->current_password, $user->password)) {
            return $this->respondWithError('Current password does not match', [], Response::HTTP_OK);
        }

        $user->password = Hash::make($request->new_password);
        $user->save();

        return $this->respondWithSuccess('Password changed successfully', $user, Response::HTTP_OK);
    }

    /**
     * Verify OTP and log in the user.
     *
     * Accepts: HTTP POST request with 'phone_number' and 'otp' fields.
     * Returns: JSON response with authentication token or error message.
     */
    public function login(Request $request)
    {
        // Validate request data
        $request->validate([
            'phone_number' => 'required', // Validate if phone number is provided
            'otp' => 'required', // Validate if OTP is provided
        ]);

        // Verify OTP
        $verified = $this->authService->verifyOTP($request->phone_number, $request->otp);

        if (!$verified) {
            return $this->respondWithError('Invalid OTP',[],Response::HTTP_OK);
        }

        // Find the user by phone number
        $user = User::where('phone_number', $request->phone_number)->first();
        
        // Check if user exists
        if (!$user) {
           $user = User::create([
            'dial_code'=>$request->dial_code,
            'phone_number'=>$request->phone_number
           ]);
        }

        // Log in the user
        $this->authService->loginUser($user);

       
        return $this->respondWithSuccess('User Login successfully',$user,Response::HTTP_OK);
      
    }
}
