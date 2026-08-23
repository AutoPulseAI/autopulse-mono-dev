<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class DealerNewPasswordNotification extends Mailable
{
    use Queueable, SerializesModels;

    public $dealer;
    public $password;

    public function __construct($dealer, $password)
    {
        $this->dealer = $dealer;
        $this->password = $password;
    }

    public function build()
    {
        return $this->subject('Your New Password')
                    ->view('emails.changeDealerPassword')
                    ->with([
                        'dealer' => $this->dealer,
                        'password' => $this->password,
                    ]);
    }
}

