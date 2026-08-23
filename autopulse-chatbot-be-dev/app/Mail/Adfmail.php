<?php 
namespace App\Mail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class Adfmail extends Mailable
{
    use Queueable, SerializesModels;

    public $user;
    public $vehicle;
    public $dealer;
    public $booking;

    /**
     * Create a new message instance.
     *
     * @return void
     */
    public function __construct( $user=null, $vehicle = null, $dealer = null, $booking = null)
    {
        $this->user = $user;
        $this->vehicle = $vehicle;
        $this->dealer = $dealer;
        $this->booking = $booking;
    }

    /**
     * Build the message.
     *
     * @return $this
     */
    public function build()
    {
        return $this->view('emails.adfmail')
                    ->subject('ADF Lead')
                    ->with([
                        'user' => $this->user,
                        'vehicle' => $this->vehicle,
                        'dealer' => $this->dealer,
                        'booking' => $this->booking,
                    ])
                    ->withSymfonyMessage(function ($message) {
                        $headers = $message->getHeaders();
                        $headers->addTextHeader('Content-Type', 'application/xml; charset=UTF-8');
                        $headers->addTextHeader('Content-Transfer-Encoding', '8bit');
                    });
    }
}