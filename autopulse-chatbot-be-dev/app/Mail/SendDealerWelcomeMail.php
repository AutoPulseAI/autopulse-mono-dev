<?php
namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class SendDealerWelcomeMail extends Mailable
{
    use Queueable, SerializesModels;

    public $details;

    public function __construct($dealer)
    {
        $this->dealer = $dealer;
    }

    /**
     * Build the message.
     *
     * @return $this
     */
    public function build()
    {
        $dealer = $this->dealer;
        return $this->view('emails.dealerwelcome')
                    ->with($dealer);
    }
}
