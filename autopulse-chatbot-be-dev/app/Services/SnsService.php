<?php

namespace App\Services;

use Aws\Sns\SnsClient;
use Twilio\Rest\Client;

class SnsService
{
   
    public function __construct()
    {
        /*$this->snsClient = new SnsClient([
            'version' => 'latest',
            'region' => env('AWS_DEFAULT_REGION'),
            'credentials' => [
                'key' => env('AWS_ACCESS_KEY_ID'),
                'secret' => env('AWS_SECRET_ACCESS_KEY'),
            ],
        ]);*/
        $this->client = new Client(env('TWILLIO_ACCCOUNT_SID_LIVE'), env('TWILLIO_AUTH_TOKEN_LIVE'));
    }

    public function sendOTP(string $phoneNumber, string $otp)
    {
       // $otp = '5   2   2   3   4   5';
        $message ='Your OTP is: ' . $otp;
        $otpWithSpaces = implode(' ', str_split($otp));
        try {
            /*$params = [
                'Message' => 'Your OTP is: ' . $otp,
                'PhoneNumber' => $phoneNumber,
            ];

            try {
                $result = $this->snsClient->publish($params);
                return true;
            } catch (\Exception $e) {
                // Log the error or handle it accordingly
                return false;
            }*/
            
            $twiml = "<Response>
            <Say loop=\"2\">
                Your Autopulse onetime passcode is
                <prosody rate=\"x-slow\" volume=\"x-loud\"> <say-as interpret-as=\"telephone\"> $otpWithSpaces</say-as></prosody>. 
                Please use this to complete your verification.
            </Say>
          </Response>";

            $call = $this->client->calls->create(
                '+'.$phoneNumber,
                env('TWILLIO_PHONE_NUMBER'),
                ["twiml" => $twiml]
            );
            
            return $call->sid;
            
          /*
            $this->client->messages->create($phoneNumber, [
                'from' => env('TWILLIO_PHONE_NUMBER'),
                'body' => $message
            ]); */
            return true;
        } catch (\Exception $e) {
                // Log the error or handle it accordingly
                return false;
        }
    }

    public function sendVerificationCode($phoneNumber)
    {
        dd($phoneNumber);
        return $this->client->verify->v2->services(env('TWILIO_VERIFY_SERVICE_SID'))
            ->verifications
            ->create($phoneNumber, 'sms');
    }

    public function sendSms(string $phoneNumber, string $msg){
        try {
            $this->client->messages->create('+'.$phoneNumber, [
                'from' => env('TWILLIO_PHONE_NUMBER'),
                'body' => $message
            ]); 
        } catch (\Exception $e) {
            // Log the error or handle it accordingly
            return false;
        }
    }
}
