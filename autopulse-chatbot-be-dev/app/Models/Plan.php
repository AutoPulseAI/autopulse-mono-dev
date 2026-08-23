<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    use HasFactory;

    protected $fillable = [
        'stripe_plan_id',
        
        'stripe_price_id',
        'name',
        'price',
        'description',
        'interval',
        'interval_count',
        'stripe_interval'
       
    ];
}
