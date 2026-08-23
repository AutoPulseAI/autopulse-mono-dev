<?php

namespace App\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Session;
use App\Models\User;
use Illuminate\Support\Str;

class AuthService
{
    public function verifyOTP($phone, string $otp)
    {
        // Retrieve stored OTP from session
        $storedOtp = Session::get('otp_' . $phone);

        // Check if stored OTP matches the one provided
        if (!$storedOtp || $storedOtp != $otp) {
            return false;
        }

        // Clear OTP from session
        Session::forget('otp_' . $phone);

        return true;
    }

    public function generateAuthToken(User $user)
    {
        // Generate authentication token for the user
        $token = Str::random(60); // or use Laravel Passport for token generation
        $user->api_token = $token;
        $user->save();

        return $token;
    }

    public function loginUser($user,$guard='')
    {
        
        Auth::guard($guard)->login($user);
       
    }
}
