<?php
  
namespace App\Http\Controllers\Admin;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Validator;
use Illuminate\Http\Response;
use App\Http\Traits\ApiResponseTrait;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;
use Illuminate\Support\Facades\Mail;
use App\Models\Page;
use App\Models\Forms;
use App\Models\FormBuilder;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use App\Helpers\Slug;
  
class PagesController extends Controller
{

    use ApiResponseTrait;

    public function index(Request $request)
    {

        $input= $request->all() ;

        $page_list = Page::query()->makeQuery($input);
        
        return view('template.admin.pages.index', compact('page_list'));
    }

    public function tableData(Request $request)
    {
        $request->merge(['page' => (($request->input('start')/ $request->input('length'))+1)]);
        $request->merge(['perPage' => $request->input('length')]);
      
        $this->perPage = $request->input('length', 3);
        $input= $request->all(); 
      
        $data = Page::query()->makeQuery($input)->paginate(  $this->perPage ); 
          
        return  response()->json([
            'data' => $data->items(),
            'draw' => $request->input('draw'), // Add draw parameter for security (optional)
            'recordsTotal' => $data->total(),
            'recordsFiltered' => $data->total(),
        ]);
    }
 
    public function create()
    {
        return view('template.admin.pages.create');
    }

    public function sections(Request $request)
    {
        $forms = FormBuilder::where('page_id', $request->id)->orderBy('section_id', 'ASC')->paginate(10);
        
        return view('template.admin.pages.sections',compact('forms'))
                    ->with('i', (request()->input('page', 1) - 1) * 5);
    }

    protected function countEndingDigits($string)
    {
        $tailing_number_digits =  0;
        $i = 0;
        $from_end = -1;
        while ($i < strlen($string)) :
        if (is_numeric(substr($string, $from_end - $i, 1))) :
            $tailing_number_digits++;
        else :
            // End our while if we don't find a number anymore
            break;
        endif;
        $i++;
        endwhile;
        return $tailing_number_digits;
    }

    protected function checkSlug($slug) {

        if(Page::where('slug',$slug)->count() > 0){
         $numIn = $this->countEndingDigits($slug);
         if ($numIn > 0) {
                  $base_portion = substr($slug, 0, -$numIn);
                  $digits_portion = abs(substr($slug, -$numIn));
          } else {
                  $base_portion = $slug . "-";
                  $digits_portion = 0;
          }
        
          $slug = $base_portion . intval($digits_portion + 1);
          $slug = $this->checkSlug($slug);
        }
        
        return $slug;
    }
  
    public function store(Request $request)
    {
        $request->validate([
            'title' => 'required|string|max:255',
            'template' => 'required',
            'meta_image' => 'image|mimes:jpeg,png,jpg,gif,svg|max:2048',
        ]);

        $daytime = date('dmyHis');

        if ($request->file('meta_image')) {
            $image = $daytime.'.'.$request->file('meta_image')->getClientOriginalExtension();
            $request->file('meta_image')->move(public_path('images/'), $image);
            $image_path = 'images/'.$image;
        }else{
            $image_path = '';
        }

        //$slug = Str::slug($request->title);

        if(Str::slug($request->title) == $page->slug){
            $slug = $page->slug;
        }else{
            $slug = $this->checkSlug(Str::slug($request->title));
        }

        Page::create([
            'title' => $request->title,
            'slug' => $slug,
            'template' => $request->template,
            'meta_image' =>'',
            'meta_title' => $request->meta_title,
            'meta_keyword' => '',
            'meta_desc' => $request->meta_desc,
        ]);
       
        return redirect()->route('pages.create')->with('status','Created successfully.');
    }

    public function edit($id)
    {
        $page = Page::findOrFail($id);
        $forms = FormBuilder::where('page_id', $page->id)->get(); 
        return view('template.admin.pages.edit',compact('page','forms'));
    }

    public function update(Request $request, $id)
    {
        $request->validate([
            'title' => 'required|string|max:255',
            'template' => 'required',
            'meta_image' => 'image|mimes:jpeg,png,jpg,gif,svg|max:2048',
        ]);
           
        $page = Page::find($id);

        $daytime = date('dmyHis');

        if ($request->file('meta_image')) {
            $meta_image = $daytime.'.'.$request->file('meta_image')->getClientOriginalExtension();
            $request->file('meta_image')->move(public_path('meta-images/'), $meta_image);
            $meta_image_path = 'meta-images/'.$meta_image;

            if(file_exists($page->meta_image))
            {
                unlink($page->meta_image);
            }

        }else{
            $meta_image_path = $page->meta_image;
        }

         //$slug = Str::slug($request->title);

         $slug = $this->checkSlug(Str::slug($request->title)); 
    
        $page->title = $request->title;
        $page->slug = $slug;
        $page->template = $request->template;
        $page->meta_image = '';
        $page->meta_title = $request->meta_title;
        $page->meta_keyword = '';
        $page->meta_desc = $request->meta_desc;

        $page->save();

        return redirect()->route('pages.edit',$id)->with('status','Updated successfully');
    }

    public function delete(Request $request)
    {
        try{
            $validator = Validator::make($request->all(), [
                'page_id'=>'required|exists:pages,id',
            ]);
            if ($validator -> fails()){
                $errors = $validator -> errors();
                return $this->respondWithError('Validation Message',$errors ,Response::HTTP_OK);
            }
            $page = Page::where('id',$request->page_id)->first()->delete();
            return $this->respondWithSuccess(__( 'Page Deleted Successfully' ), $page,Response::HTTP_OK);
        } catch (\Exception $e){
            DB::rollback();
            return $this->respondWithError('Something Went Wrong !',$e->getMessage(),Response::HTTP_INTERNAL_SERVER_ERROR);
        } 
    }
    
}