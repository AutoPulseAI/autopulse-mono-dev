<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('dealers', function (Blueprint $table) {
            $table->id();
            $table->string('name')->nullable();
            $table->string('last_name')->nullable();
            $table->string('dial_code')->nullable();
            $table->string('profile_pic')->nullable();
            $table->string('phone_number')->unique();
            $table->string('email')->nullable();
          
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password')->nullable();
            $table->text('address')->nullable();
            $table->text('address2')->nullable();
            $table->string('city')->nullable();
            $table->string('state')->nullable();
            $table->string('zip_code')->nullable();
            $table->string('country')->nullable();
            $table->string('source')->nullable();
            $table->string('latitude')->nullable();
            $table->string('longitude')->nullable();
           
            $table->rememberToken();
         
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('dealers');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('sessions');
    }
};
