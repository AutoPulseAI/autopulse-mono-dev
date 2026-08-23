<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;
use App\Models\Dealer;

class ChangeDealerPasswordMail extends Mailable
{
    use Queueable, SerializesModels;

    public $dealer;

    /**
     * Create a new message instance.
     *
     * @return void
     */
    public function __construct(Dealer $dealer)
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
        return $this->subject('Password Changed')
                    ->view('emails.changeDealerPassword');
    }
}
