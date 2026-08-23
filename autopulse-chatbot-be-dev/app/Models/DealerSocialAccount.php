<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class DealerSocialAccount extends Model
{
    use HasFactory;

    protected $fillable = [
        'dealer_id', 'provider_name', 'provider_id'
    ];

    // User
    public function user(){
        return $this->belongsTo(Dealer::class,'dealer_id','id');
    }
}
