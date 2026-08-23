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
        Schema::create('facebook_booking_tracking', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('dealer_id');
            $table->unsignedBigInteger('user_id');
            $table->string('conversation_id')->nullable();
            $table->string('vehicle_id')->nullable();
            $table->string('vehicle_title')->nullable();
            $table->string('utm_source');
            $table->string('source_type')->default('facebook_messenger');
            $table->string('page_id')->nullable(); // Facebook page ID
            $table->string('sender_id')->nullable(); // Facebook sender ID
            $table->string('session_id')->nullable(); // Unique session identifier
            $table->timestamp('visited_at');
            $table->timestamp('converted_at')->nullable(); // When booking was actually made
            $table->unsignedBigInteger('booking_id')->nullable(); // Links to actual booking if created
            $table->enum('status', ['visited', 'started_form', 'completed_form', 'converted'])->default('visited');
            $table->json('additional_data')->nullable(); // Store any extra tracking data
            $table->timestamps();

            // Foreign keys
            $table->foreign('dealer_id')->references('id')->on('dealers')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('booking_id')->references('id')->on('bookings')->onDelete('set null');

            // Indexes for better performance
            $table->index(['dealer_id', 'status']);
            $table->index(['user_id', 'status']);
            $table->index(['conversation_id', 'status']);
            $table->index('utm_source');
            $table->index('visited_at');
            $table->index('converted_at');
            $table->index('session_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('facebook_booking_tracking');
    }
};
