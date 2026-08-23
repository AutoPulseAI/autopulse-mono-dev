<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class AdminAccountMail extends Mailable
{
    use Queueable, SerializesModels;


    public $staff;
    public $newPassword;
    public $role;

    public function __construct($staff, $newPassword,$role)
    {
        $this->staff = $staff;
        $this->role = $role;
        $this->newPassword = $newPassword;
    }

    public function build()
    {
       
        return $this->view('emails.admin_staff_created')
            ->with([
                'name' => $this->staff->name,
                'email' => $this->staff->email,
                'password' => $this->newPassword,
                'role_name' =>$this->role 
            ]);
    }
}
