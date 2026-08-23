<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AssignDealer extends Model
{
    use HasFactory;
    use HasFactory;
    protected $table = 'assigned_dealer_source';
    
    protected $fillable = [
        'dealer_id',
        'dealer_source_id',
        'role_id',
       
    ];

    public function dealer()
    {
        return $this->belongsTo(Dealer::class,'dealer_id');
    }

    public function source()
    {
        return $this->belongsTo(DealerSource::class, 'dealer_source_id');
    }

    public function role()
    {
        return $this->belongsTo(Role::class,'role_id');
    }
}
