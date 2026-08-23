<?php
 
namespace App\Http\Controllers;
use Validator;
use Illuminate\Validation\Rule;
use App\Models\Contact;
use Illuminate\Http\Request;
use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use App\Models\Page;
use App\Models\Forms;
use Mail;
use App\Models\Post;

class PageController extends Controller
{
    use ApiResponseTrait;
    /**
     *
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\Response
    */

    public function pages($slug)
    {
        $pages = Page::all();
        $page = Page::where('slug', $slug)->firstOrFail();
        $forms = Forms::where('page_id', $page->id)->get();
        $posts = Post::where('is_published',true)->get()->take(3);
        return view('template.users.page', compact('pages', 'page', 'forms', 'posts'));
    }

    public function privacy()
    {
        //$page = Page::where('template', 'privacy-policy')->firstOrFail();
        //return redirect($page->slug);
        return view('template.users.privacy');
    }
    
    public function faq(Request $request)
    {
        $page = Page::where('template', 'faq')->firstOrFail();
        return redirect($page->slug);
    }

    public function about(Request $request)
    {
        $page = Page::where('template', 'about')->firstOrFail();
        return redirect($page->slug);
    }

    public function contact(Request $request)
    {
        $page = Page::where('template', 'contact')->firstOrFail();
        return redirect($page->slug);
    }


    public function term()
    {
        return view('template.users.term');
        $page = Page::where('template', 'terms-and-conditions')->firstOrFail();
        return redirect($page->slug);
    }

    public function contact_us_store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'email' => 'required|email',
            'phone' => 'required',
            'message' => 'required',
            //'subject' => 'required',
        ]);
        if ($validator -> fails()){
            $errors = $validator -> errors();
            return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);   
        }
        $request->subject ='Contact us Query';
        $contact = Contact::create([
            'name' => $request->name,
            'email' => $request->email,
            'phone' => $request->phone,
            'subject' => $request->subject,
            'message' => $request->message,
        ]);

        $data = [
            'name' => $request->name,
            'email' => $request->email,
            'phone' => $request->phone,
            'subject' => $request->subject,
            'msg' => $request->message,
        ];
        
        $emails = ['ravikathait01@gmail.com'];
        if(isset($setting['website_email']) && !empty($setting['website_email']))  
        {
            $emails[] = $setting['website_email'];
        }else{
            $emails[]  = 'info@autopulse.ai';
        }
        
        
        Mail::send('emails.contact-us', $data, function($message) use ($emails) {
            $message->to($emails)->subject('Contact Us');
        });
       
        return $this->respondWithSuccess('Mail sent successfully',[$data],Response::HTTP_OK);
           
        

       
    }

    
}

