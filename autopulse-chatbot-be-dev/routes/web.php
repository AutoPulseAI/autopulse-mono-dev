<?php

use Illuminate\Support\Facades\Route;

use App\Http\Controllers\LoginController;

use App\Http\Controllers\VisitController;
use App\Http\Controllers\VehicleController;
use App\Http\Controllers\ChatController;

use App\Http\Controllers\PageController;

use App\Http\Controllers\Admin\AdminDealerController;
use App\Http\Controllers\Admin\ConversationController;
use App\Http\Controllers\Admin\TransactionController;
use App\Http\Controllers\Admin\AdminStoreController;

use App\Http\Controllers\Admin\LeadController;
use App\Http\Controllers\WebhookController;
use App\Http\Controllers\Admin\PostController;
use App\Http\Controllers\Admin\MediaController;
use App\Http\Controllers\Admin\PlanController ;
use App\Http\Controllers\Admin\ProfileController; 
use App\Http\Controllers\Admin\AdminEmployeeController;

use App\Http\Controllers\Admin\AdminLoginController ;

use App\Http\Controllers\Auth\NewPasswordController;
use App\Http\Controllers\Auth\PasswordResetLinkController;

use App\Http\Middleware\EnsureDealerEmailVerified;
use App\Http\Middleware\checkStoreCount;
use App\Http\Controllers\Dealer\LoginController as DealerLogin;
use App\Http\Controllers\Dealer\DealerController ;
use App\Http\Controllers\Dealer\VerificationController ;
use App\Http\Controllers\Dealer\SubscriptionController; 
use App\Http\Controllers\Dealer\FacebookController; 
 
use App\Http\Controllers\Dealer\DealerChatSettingController;
use App\Http\Controllers\Admin\SettingController;
use App\Http\Controllers\Admin\BookingController;


Route::post('stripe/webhook', [WebhookController::class, 'handleWebhook']);
Route::get('chat/chatbot-settings/{user_id}', [DealerChatSettingController::class, 'getUserChatbotSettings']);

Route::get('dealer/email/verify/{id}/{hash}', [VerificationController::class, 'verify'])->name('verification.verify');

Route::get('/vehicle', [VehicleController::class, 'searchActiveCars'])->name('vechile');
Route::get('/dealer/vehicle', [VehicleController::class, 'dealerVehicle'])->name('source.vechile');

Route::get('/vehicle-detail/{make_model_year}/{vin}', [VehicleController::class, 'getVehicleDetail'])->name('vehicle_detail');

Route::post('chat', [ChatController::class, 'index'])->name('chat');
Route::get('chat', [ChatController::class, 'view'])->name('view');
Route::post('/request-demo', [DealerLogin::class, 'requestDemo'])->name('dealer.requestDemo');
    
Route::prefix('')->group(function () {
    
    Route::get('/', [DealerLogin::class, 'index'])->name('dealer.index');

    //Route::get('/login', [DealerLogin::class, 'loginpage'])->name('login');
    Route::get('/dealer-login', [DealerLogin::class, 'loginpage'])->name('login');
    Route::get('user-reset/{token}', [DealerLogin::class, 'resetPwd'])->name('dealer.reset');
    Route::get('/login', [DealerLogin::class, 'loginpage'])->name('dealer.login');
    Route::get('/social-login/{provider}/callback',[DealerLogin::class,'providerCallback']);
    Route::get('/social-auth/{provider}',[DealerLogin::class,'redirectToProvider'])->name('dealer.social.redirect');
    
    Route::post('/loginemail', [DealerLogin::class, 'userLogin'])->name('dealerlogin');
    Route::get('/signup', [DealerLogin::class, 'signuppage'])->name('dealer.signup');
    Route::get('/forgot-password', [DealerLogin::class, 'forgotpasswordpage'])->name('dealer.forgot-password');
    Route::get('/contact', [DealerLogin::class, 'contactpage'])->name('dealer.contact');
    Route::post('/contactus', [PageController::class, 'contact_us_store'])->name('contactus.post');

    Route::post('/register', [DealerLogin::class, 'dealerRegister'])->name('dealerregister');
    Route::post('/register_preview', [DealerLogin::class, 'dealerRegisterPreview'])->name('dealerregister_preview');
    Route::post('/forgotpassword', [DealerLogin::class, 'forgotPassword'])->name('dealerforgotPassword');
    Route::post('/dealer-password/reset', [DealerLogin::class, 'resetPassword'])->name('dealerpassword.update');

    // Route for generating OTP for dealer login
  
    Route::post('/login', [DealerLogin::class, 'login'])->name('dealer.validateOtp');
    Route::get('/conversation/export', [ConversationController::class, 'exportAllConversations'])->name('dealer.conversionexport');
            
    Route::middleware(['auth:dealer'])->group(function () {


        Route::post('/user_change-password', [LoginController::class, 'changePassword'])->name('dealer.changePassword');
        Route::get('/sendverify', [DealerController::class, 'sendVerification'])->name('dealer.sendverify');
        Route::get('/logout', [DealerController::class, 'logout'])->name('dealer.logout');
        Route::get('/dealerverification', [DealerController::class, 'logout'])->name('dealer.verification');
        Route::post('/updateAddress', [DealerController::class, 'updateAddress'])->name('dealer.updateAddress');
        Route::post('/updateProfile', [DealerController::class, 'updateProfile'])->name('dealer.updateProfile');
        Route::post('/updateProfilepic', [DealerController::class, 'updateProfilepic'])->name('dealer.updateProfilepic');
        Route::get('/profile', [DealerController::class, 'profile'])->name('dealer.profile');
        Route::get('/sendverification', [DealerController::class, 'sendVerification'])->name('dealer.sendverify');
        
       
       
        Route::middleware(EnsureDealerEmailVerified::class)->group(function () {

            Route::prefix('/chat-setting')->group(function () {
                
                Route::post('add', [DealerChatSettingController::class, 'add'])->name('chatbot_settings.store');
                
                Route::post('updatechat', [DealerChatSettingController::class, 'update'])->name('chatbot_settings.update');
                Route::get('', [DealerChatSettingController::class, 'index'])->name('dealer.chat.index');
            });
            
            Route::middleware(checkStoreCount::class)->group(function () {
                Route::get('/facebook/add', [FacebookController::class, 'index'])->name('dealer.facebook');
                Route::get('/facebook/connect', [FacebookController::class, 'redirectToFacebook'])->name('facebook.connect');
                Route::get('/facebook/callback', [FacebookController::class, 'handleFacebookCallback']);
                Route::post('/disconnect', [FacebookController::class, 'disconnect'])->name('facebook.disconnect');
                 Route::post('/test-webhook', [FacebookController::class, 'testWebhook'])->name('facebook.test-webhook');
                Route::post('/create_cancel_request', [SubscriptionController::class, 'createRequest'])->name('create_cancel_request');
                Route::post('/subscribe-pages', [FacebookController::class, 'subscribeExistingPages'])->name('facebook.subscribe-pages');
                Route::get('/webhook-status', [FacebookController::class, 'checkWebhookStatus'])->name('facebook.webhook-status');
                Route::get('/conversation', [ConversationController::class, 'dealerConversion'])->name('dealer.conversation');
                Route::get('/conversation/{conversationId}', [ConversationController::class, 'dealerConversationDetail'])->name('dealer.conversation.detail');
                Route::get('/requestinfo', [DealerController::class, 'requestInfo'])->name('dealer.requestinfo');
               
                Route::get('/billing', [SubscriptionController::class, 'billing'])->name('dealer.billing');
                Route::get('/cancelsubscription', [SubscriptionController::class, 'cancelSubscription'])->name('dealer.cancelsubscription');
                Route::get('/subscription/success', [SubscriptionController::class, 'subscriptionSuccess'])->name('dealer.subscription.success');
                Route::get('/subscription/failed', [SubscriptionController::class, 'billing'])->name('dealer.subscription.cancel');
                Route::get('/subscription/create', [SubscriptionController::class, 'createSubscription'])->name('subscription.create');
                Route::get('/payment_method', [SubscriptionController::class, 'myPaymentMethod'])->name('dealer.payment_method');
                Route::post('/updatecard', [SubscriptionController::class, 'updateCard'])->name('dealer.update.card');
                Route::get('/add_payment_method', [SubscriptionController::class, 'addPaymentMethod'])->name('dealer.add_payment_method');
                Route::post('/checksubscription', [SubscriptionController::class, 'checkPlan'])->name('subscribe.checkPlan');
                Route::post('/subscribe', [SubscriptionController::class, 'processSubscriptionAjax'])->name('subscribe.process.ajax');
                Route::get('/dashboard', [DealerController::class, 'index'])->name('dealer.dashboard');
                Route::get('/verify', [DealerController::class, 'profile'])->name('dealer.verify');
                //Route::get('/subscription', [DealerController::class, 'subscription'])->name('dealer.subscription');
                Route::get('/myvehicle', [DealerController::class, 'myvehicle'])->name('dealer.myvehicle');
                Route::get('/mylead', [DealerController::class, 'mylead'])->name('dealer.mylead');
                        Route::get('/mybooking', [DealerController::class, 'myBooking'])->name('dealer.mybooking');
        Route::get('/exportbooking', [DealerController::class, 'bookingDownload'])->name('dealer.mybookingdownlod');
        Route::get('/export-tracking', [DealerController::class, 'exportTrackingData'])->name('dealer.export-tracking');
                Route::get('/exportlead', [DealerController::class, 'leadDownload'])->name('dealer.export.leads');
                Route::get('/car_detail', [DealerController::class, 'carDetail'])->name('dealer.car_detail');
                Route::get('/myleadcar', [DealerController::class, 'myleadCar'])->name('dealer.myleadcar');
                Route::get('/lead_detail', [DealerController::class, 'leadDetail'])->name('dealer.lead_detail');
            });
           
        });
    });
});

Route::prefix('admin')->group(function () {

    Route::get('/', [AdminLoginController::class, 'index'])->name('admin.login');
    Route::get('/forget', [PasswordResetLinkController::class, 'create'])
    ->name('password.request');

    Route::post('forget', [PasswordResetLinkController::class, 'store'])
    ->name('password.email');

    Route::get('reset-password/{token}', [NewPasswordController::class, 'create'])
    ->name('password.reset');

    Route::post('reset-password', [NewPasswordController::class, 'store'])
    ->name('password.store');
    
    Route::post('/', [AdminLoginController::class, 'login'])->name('admin.submitLogin');

    Route::middleware('auth:admin')->group(function () {
        Route::get('/dashboard', [ProfileController::class, 'index'])->name('admin.dashboard');
        Route::get('/profile', [ProfileController::class, 'profile'])->name('admin.profile');
        Route::get('/editProfile', [ProfileController::class, 'editProfile'])->name('admin.editProfile');
        Route::post('/updateProfile', [ProfileController::class, 'updateProfile'])->name('admin.updateProfile');
        Route::post('/updatePassword', [ProfileController::class, 'updatePassword'])->name('admin.updatePassword');
        Route::get('/logout', [ProfileController::class, 'logout'])->name('admin.logout');

        Route::get('/log', [ConversationController::class, 'index'])->name('admin.log');
        Route::get('/logstore', [ConversationController::class, 'index'])->name('admin.log');
        Route::prefix('/cancellation-request')->group(function () {
            Route::get('/', [AdminStoreController::class, 'cancelRequest'])->name('admin.cancellation.request.list');
            Route::get('/data', [AdminStoreController::class, 'cancelRequestData'])->name('cancellation.request.data');
            Route::get('/approve', [AdminStoreController::class, 'approveRequest'])->name('admin.request.approve');
            Route::get('/reject', [AdminStoreController::class, 'rejectRequest'])->name('admin.request.reject');
        });
        Route::prefix('/employee')->group(function () {
            Route::post('/check-role-permission', [AdminEmployeeController::class, 'checkRolePermission'])->name('admin.checkrole');;
            Route::get('/', [AdminEmployeeController::class, 'index'])->name('admin.employee');
            Route::get('/data', [AdminEmployeeController::class, 'employeeData'])->name('admin.staff.data');
            Route::post('/', [AdminEmployeeController::class, 'storeEmployee'])->name('admin.staff.save');
            Route::post('/update',[AdminEmployeeController::class, 'updateEmployee'])->name('admin.staff.update');
            Route::get('/delete', [AdminEmployeeController::class, 'deleteEmployee'])->name('admin.staff.delete');
            Route::post('/changepassword', [AdminEmployeeController::class, 'resetPassword'])->name('admin.staff.changePassword');
        });
        Route::prefix('/storelist')->group(function () {
            Route::post('/dealers/import', [AdminDealerController::class, 'import'])->name('dealers.import');
            
            Route::get('/loginasdealer', [AdminDealerController::class, 'loginAs'])->name('loginasdealer');
            Route::get('/alldealers', [AdminDealerController::class, 'alldealers'])->name('alldealers.index');
            Route::get('/', [AdminDealerController::class, 'dealerlist'])->name('dealerlist.index');
            Route::get('/delete', [AdminDealerController::class, 'dealerlist_delete'])->name('dealerlist.delete');
            Route::post('/register', [AdminDealerController::class, 'dealerRegister'])->name('dealerlist.store');
            Route::post('/update', [AdminDealerController::class, 'dealerUpdate'])->name('dealerlist.update');
            Route::post('/changepassword', [AdminDealerController::class, 'changepassword'])->name('dealerlist.changepassword');
            Route::post('/cancel-subscription', [AdminDealerController::class, 'cancelDealerSubscription'])->name('admin.dealer.cancel.subscription');
            Route::get('/tableData', [AdminDealerController::class, 'dealerlist_tableData'])->name('dealerlist.tableData');
            Route::get('getdealer', [AdminDealerController::class, 'dealerlist_edit'])->name('dealerlist.edit');
            Route::post('/import', [AdminDealerController::class, 'import'])->name('dealers.import');
            Route::get('/downloadCSV', [AdminDealerController::class, 'downloadCSV'])->name('dealerlist.downloadCSV');

        });

        Route::post('/setting', [SettingController::class, 'updateSetting'])->name('admin.settingupdate');
        Route::post('/updateProfile', [ProfileController::class, 'updateProfile'])->name('admin.updateProfile');
        Route::get('/setting', [SettingController::class, 'index'])->name('admin.setting');

        Route::get('/plan', [PlanController::class, 'index'])->name('admin.plan.index');
        Route::post('/plan/add', [PlanController::class, 'storePlan'])->name('admin.plan.add');
        Route::post('/plan/update', [PlanController::class, 'updatePlan'])->name('admin.plan.update');
        Route::get('/plan/delete', [PlanController::class, 'deletePlan'])->name('admin.plan.delete');

        Route::get('/lead', [LeadController::class, 'index'])->name('lead.index');
        Route::get('/lead/delete', [LeadController::class, 'leadlist_delete'])->name('lead.delete');
        Route::get('/lead/view', [LeadController::class, 'leadlistView'])->name('lead.view');
       // Route::post('/lead/store', [LeadController::class, 'dealerlist_store'])->name('lead.store');
        Route::get('/lead/tableData', [LeadController::class, 'leadTableData'])->name('lead.tableData');
        Route::get('/lead/downloadlead', [LeadController::class, 'leadDownload'])->name('lead.download');
      
        Route::prefix('/transaction')->group(function () {
            Route::get('/', [TransactionController::class, 'index'])->name('admin.transaction');
            Route::get('/delete', [TransactionController::class, 'delete'])->name('admin.transaction.delete');
            Route::get('/data', [TransactionController::class, 'data'])->name('admin.transaction.data');
            Route::post('/', [TransactionController::class, 'add'])->name('admin.transaction.add');
            Route::post('/update', [TransactionController::class, 'update'])->name('admin.transaction.update');
            // In routes/web.php
            Route::get('/csv', [TransactionController::class, 'downloadCSV'])->name('admin.transaction.csv');

        });
        Route::prefix('/booking')->group(function () {
            //Route::get('/', [BookingController::class, 'index'])->name('admin.transaction');
            Route::get('/', [BookingController::class, 'index'])->name('booking.index');
            Route::get('/delete', [BookingController::class, 'leadlist_delete'])->name('booking.delete');
            Route::get('/view', [BookingController::class, 'leadlistView'])->name('booking.view');
           // Route::post('/lead/store', [LeadController::class, 'dealerlist_store'])->name('lead.store');
            Route::get('/tableData', [BookingController::class, 'leadTableData'])->name('booking.tableData');
            Route::get('/downloadlead', [BookingController::class, 'leadDownload'])->name('booking.download');
          

        });
        Route::prefix('/request-demo')->group(function () {
            Route::get('/', [SettingController::class, 'requestDemo'])->name('reqeust.index');
            Route::get('/{id}/show', [SettingController::class, 'requestShow'])->name('request.show');
            Route::get('/delete', [SettingController::class, 'requestDemoDelete'])->name('request.delete');;
            Route::get('/tableData', [SettingController::class, 'requestDatatable'])->name('request.tableData');
        });


    });

});
Route::get('/term-and-conditions', [PageController::class, 'term'])->name('term');
Route::get('/privacy-policy', [PageController::class, 'privacy'])->name('privacy');

// Facebook Messenger Booking Routes
Route::prefix('booking')->group(function () {
    Route::get('/visit', [App\Http\Controllers\BookingController::class, 'showBookingForm'])->name('booking.visit');
    Route::post('/process', [App\Http\Controllers\BookingController::class, 'processBooking'])->name('booking.process');
    Route::get('/success/{id}', [App\Http\Controllers\BookingController::class, 'showSuccess'])->name('booking.success');
    Route::get('/analytics/{dealerId}', [App\Http\Controllers\BookingController::class, 'getTrackingAnalytics'])->name('booking.analytics');
    Route::get('/export-tracking/{id}', [App\Http\Controllers\BookingController::class, 'exportTrackingData'])->name('booking.export-tracking');
});
