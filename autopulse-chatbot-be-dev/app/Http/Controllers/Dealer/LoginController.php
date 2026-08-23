<?php
 
namespace App\Http\Controllers\Dealer;
 
use App\Models\Dealer;
use App\Models\DealerSocialAccount;
use App\Models\RequestDemo;
use Illuminate\View\View;
use App\Mail\NotifyAdmin;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\Facades\Mail;
use App\Models\Plan;
use Illuminate\Support\Str;
use App\Services\SnsService;
use App\Services\AuthService;
use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use Validator;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Log;
use App\Jobs\SendDealerWelcomeEmailJob;
use Spatie\Permission\Models\Role;
use DB;
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

    public function index(Request $request)
    {
        $token = $request->token;
        $plans = Plan::orderBy('price','asc')->first();
        $dealer = auth('dealer')->user();
    
        return view('template.dealers.index', compact('plans','dealer','token'));
      
    }

    public function redirectToProvider(String $provider){
        $redirectUrl = config("services.$provider.dealer_redirect");
       // dd($dealer_redirect);
       \Log::debug('Redirect URL being used: ' . $redirectUrl);
        return \Socialite::driver($provider)
        ->redirectUrl($redirectUrl)
        ->redirect();
    }

    public function providerCallback(String $provider){
        try{
           
           
            if($provider=='linkedin'){
                $provider ='linkedin-openid';
            }
            $redirectUrl = config("services.$provider.dealer_redirect");
           
            $social_user = \Socialite::driver($provider)->redirectUrl($redirectUrl)->user();
           
            $account = DealerSocialAccount::where([
                'provider_name'=>$provider,
                'provider_id'=>$social_user->getId()
            ])->first();

            $user = Dealer::where([
                'email'=>$social_user->getEmail()
            ])->first();

            if(!$user){
                $user = Dealer::create([
                    'email'=>$social_user->getEmail(),
                    'name'=>$social_user->getName(),
                    'phone_number'=>'',
                    'status'=>1,
                    'email_verified_at' =>now(),
                    'social_account'=>true
                ]);
                $this->createAdminRole($user);
                SendDealerWelcomeEmailJob::dispatch($user);
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
            $this->authService->loginUser($user,'dealer');
           
            return redirect()->route('dealer.profile');

        }catch (Exception $e) {
            \Log::error('Error during callback: ' . $e->getMessage());
            return redirect(route('dealer.index'))->with('error', 'Something went wrong during login.');
        }
    }  

    public function loginpage()
    {
        if (Auth::guard('dealer')->check()) {
            return redirect(route('dealer.profile'));
        }
        return view('template.dealers.login');
    }

    public function signuppage()
    {
        $user = Auth::guard('dealer')->user();
        if($user){
            return redirect(route('dealer.profile'));
        }
        return view('template.dealers.signup');
    }

    public function forgotpasswordpage()
    {
        $user = Auth::guard('dealer')->user();
        if($user){
            return redirect(route('dealer.profile'));
        }
        return view('template.dealers.forgot-password');
    }

    public function contactpage()
    {
        return view('template.dealers.contact');
    }


    public function dealerRegisterPreview(Request $request)
    {

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            
            'email' => 'required|string|email|max:255|unique:users',
            'password' => 'required|string|min:8|same:confirm_password',
            'confirm_password' => 'required|string|min:8', // Add this line
            //'phone_number' => 'required|numeric|digits:10|unique:users',
               
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }
        return $this->respondWithSuccess('User registered successfully. Please verify your email.', [], Response::HTTP_OK);
    }
    public function dealerRegister(Request $request)
    {
        $data = $request->all();
        if (!empty($data['source']) && !preg_match('/^https?:\/\//i', $data['source'])) {
            $request->source = preg_replace('/^www\./', '', $request->source);
            $request->source =   $data['source'] = 'https://' . $data['source'];
        }
        $validator = Validator::make($data, [
            'name' => 'required|string|max:255',
            
            'email' => 'required|string|email|max:255|unique:dealers',
            'password' => 'required|string|min:8|same:confirm_password',
            'confirm_password' => 'required|string|min:8', // Add this line
            'phone_number' => 'required|numeric|digits:10|unique:dealers',
           
           
               
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }
        
        $dealer = Dealer::create([
            'name' => $request->name,
           
            'email' => $request->email,
            'phone_number' => $request->phone_number,
            'password' => Hash::make($request->password),
          

        ]);
        $dealer->sendEmailVerificationNotification();

        Auth::guard('dealer')->login($dealer);
        return $this->respondWithSuccess('User registered successfully. Please verify your email.', $dealer, Response::HTTP_OK);
    }

    public function createAdminRole($dealer){
        $role =Role::where('name', 'admin_' . $dealer->id)->first();
        if(!$role){
            $role = Role::create([
                'name' => 'admin_' . $dealer->id,
                'guard_name' => 'dealer',
                'dealer_id' => $dealer->id,
            ]);
        }
        $dealer->assignRole('admin_' . $dealer->id);
        $permissions = [
            'manage employee',
            'manage role',
            'manage store',
            'view lead',
            'View Store Vehicles',
            'manage payment',
            'View Analytics'
        ];
        $role->givePermissionTo($permissions);
    }

    public function userLogin(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|string|email',
            'password' => 'required|string',
        ]);
        
        if ($validator->fails()) {
            $errors = $validator->errors();
            return $this->respondWithError('Validation Message', $errors, Response::HTTP_OK);   
        }
        
        try {
            $email = strtolower($request->input('email'));
            $password = $request->input('password');
            
            // First find the user by case-insensitive email
            $dealer = \App\Models\Dealer::where(DB::raw('LOWER(email)'), $email)->first();
            
            // Then verify credentials
            if ($dealer && Hash::check($password, $dealer->password)) {
                Auth::guard('dealer')->login($dealer);
                $dealer->update(['social_account' => false]);
                return $this->respondWithSuccess('User login successfully', $dealer, Response::HTTP_OK);
            }
            
            return $this->respondWithError('Invalid email or password', [], Response::HTTP_OK);
        } catch (\Exception $e) {
            return $this->respondWithError('Invalid email or password', [], Response::HTTP_OK);
        }
    }
    public function resetPwd(Request $request)
    {
        $token = $request->token;
       
        return view('template.dealers.reset', compact('token'));
      
    }

    public function forgotPassword(Request $request)
    {
        $request->validate(['email' => 'required|email']);

        $dealer = Dealer::where('email', $request->email)->first();
        
        if (is_null($dealer)) {
            return $this->respondWithError('User does not exist', [], Response::HTTP_OK);
        }

        $token = Password::broker('dealer')->createToken($dealer);

        $dealer->sendPasswordResetNotification($token);

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

        $status = Password::broker('dealer')->reset(
            $request->only('email', 'password', 'token'),
            function ($dealer, $password) {
                $dealer->forceFill([
                    'password' => Hash::make($password)
                ])->save();
    
                $dealer->setRememberToken(Str::random(60));
    
                Auth::guard('dealer')->login($dealer);
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

        $user =  Auth::guard('dealer')->user();

        if (!Hash::check($request->current_password, $user->password)) {
            return $this->respondWithError('Current password does not match', [], Response::HTTP_OK);
        }

        $user->password = Hash::make($request->new_password);
        $user->save();

        return $this->respondWithSuccess('Password changed successfully', $user, Response::HTTP_OK);
    }

    public function requestDemo(Request $request){
       
        $validator = Validator::make($request->all(), [
         
            'dealership_name' => 'required', 
            'first_name' => 'required', 
            'last_name' => 'required', 
            'phone' => 'required|digits:10|numeric',
            'email' => 'required', 
            'website' => 'required', 
            
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }
        $data = $request->only([ 'dealership_name', 'first_name', 'last_name', 'phone', 'email', 'website']);
      //  $data['first_name'] =   $data['last_name'];
        RequestDemo::create($data);
        
       

        $emails = ['test@test.com','test2@test.com','test3@test.com'];
      
        Mail::to($emails)->send(new NotifyAdmin($data));

        return $this->respondWithSuccess('Mail Send successfully',$data,Response::HTTP_OK);

    }
}
