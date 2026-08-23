<?php
namespace App\Http\Controllers\Admin;
 
use App\Models\Setting;
use Illuminate\View\View;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Session;

use Illuminate\Support\Str;
use App\Services\SnsService;
use App\Services\AuthService;
use App\Http\Traits\ApiResponseTrait;
use  Illuminate\Http\Response;
use Validator;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Storage;
use App\Http\Controllers\Controller;
use App\Models\Home;
use App\Models\Ads;
use App\Models\Contact;
use App\Models\RequestDemo;
use App\Models\Post;
use App\Models\Media;
 
class SettingController extends Controller
{
    use ApiResponseTrait;
    /**
     * Display the setting page for the authenticated admin.
     *
     * @return \Illuminate\Contracts\View\View
     */
    public function index(): View
    {
        return view('template.admin.setting');
    }

    /**
     * Update the Website Setting .
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\Response
     */
    public function updateSetting(Request $request)
    {   
        $data = $request->except(['_token', '_method']);
       
        foreach ($data as $key => $value) {
            $allkey[$key] = $value;
            if ($request->hasFile($key)) {

                $file = $request->file($key);
                $path = $file->store('setting', 's3'); 
                $url= Storage::disk('s3')->url($path);
        
                // Update or create setting for file
                $setting = Setting::updateOrCreate(
                    ['meta_key' => $key],
                    ['meta_value' => $url]
                );
            } else {
                // Update or create setting for regular value
                $setting = Setting::updateOrCreate(
                    ['meta_key' => $key],
                    ['meta_value' => $value]
                );
            }
        }
        return redirect()->back()->with('success', 'Your Setting has been saved successfully.');
    }  

    public function blog_list()
    {
        $posts = Post::where('is_published',true)->get()->all();
        $title = 'Blog';
        return view('template.users.posts', compact('posts', 'title'));
    }
    public function blog($slug)
    {
        $post = Post::where('is_published',true)->where('slug', $slug)->firstOrFail();
        $posts = Post::where('is_published',true)->where('id','!=', $post->id)->orderBy('id','desc')->get()->take(5);
        $prev = Post::where('id', '<', $post->id)->orderBy('id','desc')->first(); 
        $next = Post::where('id', '>', $post->id)->orderBy('id','asc')->first(); 
        return response()->view('template.users.show-blog', compact('post','posts','prev','next'));
    }

    public function media_list()
    {
        $media = Media::where('is_published',true)->get()->all();
        $title = 'Media';
        return view('template.users.media', compact('media', 'title'));
    }
    public function media($slug)
    {
        $media = Media::where('is_published',true)->where('slug', $slug)->firstOrFail();
        $medias = Media::where('is_published',true)->where('id','!=', $media->id)->orderBy('id','desc')->get()->take(5);
        return response()->view('template.users.show-media', compact('media','medias'));
    }

    public function ads(): View
    {
        $ads = Ads::first();

        return view('template.admin.ads', compact('ads'));
    }

    public function contact_us(Request $request)
    {

        $input= $request->all() ;

        $contact = Contact::query()->makeQuery($input);
        
        return view('template.admin.contact-us.index', compact('contact'));
    }

    public function contact_tableData(Request $request)
    {
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
        $input= $request->all(); 
      
        $data = Contact::query()->makeQuery($input)->paginate( $this->perPage );
          
        return  response()->json([
            'data' => $data->items(),
            'draw' => $request->input('draw'), // Add draw parameter for security (optional)
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    public function contact_us_show($id)
    {
        $contact = Contact::find($id);
        return response()->json($contact);
    }

    public function contact_us_delete(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'contact_id'=>'required|exists:contact_us,id',
            ]);
            if ($validator -> fails()){
                $errors = $validator -> errors();
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);
            }
            $contact = Contact::where('id',$request->contact_id)->first()->delete();
            return $this->respondWithSuccess(__( 'Contact Deleted Successfully' ), $contact,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }

    public function requestShow($id)
    {
        $contact = RequestDemo::find($id);
        return response()->json($contact);
    }

    public function requestDemo(Request $request)
    {

        $input= $request->all() ;
        return view('template.admin.request.index');
    }

    public function requestDatatable(Request $request)
    {
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
        $input= $request->all(); 
      
        $data = RequestDemo::query()->makeQuery($input)->paginate( $this->perPage );
          
        return  response()->json([
            'data' => $data->items(),
            'draw' => $request->input('draw'), // Add draw parameter for security (optional)
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }

    public function requestDemoDelete(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'reqeust_id'=>'required|exists:request_demo,id',
            ]);
            if ($validator -> fails()){
                $errors = $validator -> errors();
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);
            }
            $contact = RequestDemo::where('id',$request->reqeust_id)->first()->delete();
            return $this->respondWithSuccess(__( 'Request Deleted Successfully' ), $contact,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }

}
