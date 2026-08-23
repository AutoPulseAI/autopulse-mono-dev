<?php 
namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AssignAdminDealer extends Model
{
    use HasFactory;

    protected $table = 'admin_dealer_group';

    protected $fillable = ['admin_id', 'dealer_id'];  // <-- Corrected: added a comma between 'admin_id' and 'dealer_id'

    public function admin()
    {
        return $this->belongsTo(Admin::class);
    }

    public function dealer()
    {
        return $this->belongsTo(Dealer::class);
    }
}
