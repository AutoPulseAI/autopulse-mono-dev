<?php
namespace App\Jobs;

use App\Mail\DealerVerificationMail;
use App\Models\Dealer;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Mail;

class SendDealerVerificationEmail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    protected $dealer;
    protected $password;

    public function __construct(Dealer $dealer, $password)
    {
        $this->dealer = $dealer;
        $this->password = $password;
    }

    public function handle()
    {
        Mail::to($this->dealer->email)->send(new DealerVerificationMail($this->dealer, $this->password));
    }
}
