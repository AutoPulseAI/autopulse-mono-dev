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
        Schema::connection('secondary_db')->create('conversations', function (Blueprint $table) {
            $table->char('conversation_id', 36);
            $table->string('request_token', 255)->nullable();
            $table->dateTime('request_timestamp')->nullable();
            $table->text('request')->nullable();
            $table->text('response')->nullable();
            $table->string('response_token', 255)->nullable();
            $table->dateTime('response_timestamp')->nullable();
            $table->text('context')->nullable();
            $table->string('followup_id', 100)->nullable();
            $table->float('nlp_threshold')->nullable();
            $table->text('URL')->nullable();
            $table->text('additional_info')->nullable();
            $table->text('api_url')->nullable();
            $table->timestamp('chat_close_time')->nullable(); // Replace with the desired column type
            $table->integer('time_diff')->default(0); 
             $table->integer('user_id')->nullable(); 
            
            $table->timestamps(); // Optional: adds created_at and updated_at columns
        });
       
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::connection('secondary_db')->dropIfExists('conversations');
    }
};
