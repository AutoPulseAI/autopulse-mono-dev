<?php 
// app/Mail/DealerVerificationMail.php

namespace App\Mail;

use App\Models\Dealer;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class DealerVerificationMail extends Mailable
{
    use Queueable, SerializesModels;

    public $dealer;
    public $password;

    public function __construct(Dealer $dealer, $password)
    {
        $this->dealer = $dealer;
        $this->password = $password;
    }

    public function build()
    {
        return $this->subject('Dealer Account Verification')
                    ->view('emails.dealer_verification')
                    ->with([
                        'dealer' => $this->dealer,
                        'password' => $this->password,
                    ]);
    }
}
