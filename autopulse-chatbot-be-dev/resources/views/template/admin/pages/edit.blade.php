@extends('layouts.admin')
@section('content')
<input type="hidden" id="seturl" value="">
<!-- Page Content Start -->
<div class="admin_inner_content bg-white">
    <div class="row">
        <div class="page_title d-flex align-items-center">
            <h2 class="mb-0">Page</h2>
        </div>
    </div>
    @if(session()->has('success'))
        <div class="row">
            <div class="alert alert-success alert-dismissible text-white" role="alert">
                <span class="text-sm">{{ Session::get('success') }}</span>
                <button type="button" class="btn-close text-lg py-3 opacity-10"
                    data-bs-dismiss="alert" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        </div>
    @endif
    <hr>

    <div class="row carpages">
        
        <div class="col col-12">
            <div class="card-body px-0 pb-2">

                <div class="px-3">

                        <div class="nav-wrapper position-relative end-0">
                            <ul class="nav nav-pills nav-fill p-1" role="tablist">
                                <li class="nav-item">
                                    <a href="#tab-0" class="nav-link mb-0 px-0 py-1 tab active" data-bs-toggle="tab"
                                        role="tab" aria-selected="true">
                                        <span class="ms-1">Page Information</span>
                                    </a>
                                </li>
                                @if($forms)
                                @foreach($forms as $data)
                                    <li class="nav-item">
                                        <a href="#tab-{{$data->id}}" class="nav-link mb-0 px-0 py-1 tab" data-bs-toggle="tab"
                                        role="tab" aria-selected="true">
                                            <span class="ms-1">Page Content</span>
                                        </a>
                                    </li>
                                @endforeach
                                @endif
                            </ul>
                        </div>
                    
                </div>


                <div class="card-body p-3">
                    @if(session()->has('status'))
                    <div class="row">
                        <div class="alert alert-success alert-dismissible text-white" role="alert">
                            <span class="text-sm">{{ Session::get('status') }}</span>
                            <button type="button" class="btn-close text-lg py-3 opacity-10"
                                data-bs-dismiss="alert" aria-label="Close">
                                <span aria-hidden="true">&times;</span>
                            </button>
                        </div>
                    </div>
                    @endif

                    <div id="tab-0" class="row tab-content active">

                    <form method='POST' action='{{ route('pages.update',$page->id) }}' enctype="multipart/form-data">
                        @csrf
                        @method('put')
                        <div class="row">
                            
                            <div class="mb-3 col-md-6">
                                <label class="form-label">Title <span class="text-danger">*</span></label>
                                <input type="text" name="title" class="form-control border border-2 p-2"  placeholder="Title" value='{{ old('title',$page->title) }}'>
                                @error('title')
                                <p class='text-danger inputerror'>{{ $message }} </p>
                                @enderror
                            </div>

                            <div class="mb-3 col-md-6">
                                <label class="form-label">Template <span class="text-danger">*</span></label>
                                <select name="template" class="form-control border border-2 p-2">
                                    <option value="" disabled>Select Template</option>
                                    <option value="about" {{ old('template',$page->template) == 'about' ? 'selected' : '' }}>About</option>
                                    <option value="contact" {{ old('template',$page->template) == 'contact' ? 'selected' : '' }}>Contact</option>
                                    <option value="privacy-policy" {{ old('template',$page->template) == 'privacy-policy' ? 'selected' : '' }}>Privacy Policy</option>
                                    <option value="terms-conditions" {{ old('template',$page->template) == 'terms-conditions' ? 'selected' : '' }}>Terms & Conditions</option>
                                    <option value="faq" {{ old('template',$page->template) == 'faq' ? 'selected' : '' }}>Faqs</option>
                                </select>
                                @error('template')
                                <p class='text-danger inputerror'>{{ $message }} </p>
                                @enderror
                            </div>

                                                                    
                            <div class="mb-3 col-md-6">
                                <label class="form-label">Meta Title </label>
                                <input type="text" name="meta_title" class="form-control border border-2 p-2"  placeholder="Meta Title" value='{{ old('meta_title',$page->meta_title) }}'>
                                @error('meta_title')
                                <p class='text-danger inputerror'>{{ $message }} </p>
                                @enderror
                            </div>
                            
                            <!--div class="mb-3 col-md-6">
                                <label class="form-label">Meta Image</label>
                                <input type="file" name="meta_image" class="form-control border border-2 p-2" value='{{ old('meta_image',$page->meta_image) }}'>
                                @error('meta_image')
                                <p class='text-danger inputerror'>{{ $message }} </p>
                                @enderror
                            </div-->

                            <!--div class="mb-3 col-md-12">
                                <label for="floatingTextarea2">Meta Keyword</label>
                                <textarea class="form-control border border-2 p-2"
                                    placeholder="Meta Keyword" id="floatingTextarea2" name="meta_keyword"
                                    rows="4" cols="50">{{ old('meta_keyword',$page->meta_keyword) }}</textarea>
                                    @error('meta_keyword')
                                    <p class='text-danger inputerror'>{{ $message }} </p>
                                    @enderror
                            </div-->
                        
                            <div class="mb-3 col-md-12">
                                <label for="floatingTextarea2">Meta Description</label>
                                <textarea class="form-control border border-2 p-2"
                                    placeholder="Meta Description" id="floatingTextarea2" name="meta_desc"
                                    rows="4" cols="50">{{ old('meta_desc',$page->meta_desc) }}</textarea>
                                    @error('meta_desc')
                                    <p class='text-danger inputerror'>{{ $message }} </p>
                                    @enderror
                            </div>
                        </div>

                        <button type="submit" class="btn btn_theme">Save</button>
                    </form>

                    </div>
                    @if($forms)
                    @foreach($forms as $form)
                    <div id="tab-{{$data->id}}" class="row tab-content">
                    <form method="POST" action="{{ route('forms.create') }}" enctype="multipart/form-data">
                        @csrf
                            <input type="number" id="form_id" name="form_id" value="{{$form->id}}" hidden/>
                            <input type="number" id="page_id" name="page" value="{{$form->page_id}}" hidden/>
                            <div id="form-content" style="display:none;">{{$form->content}}</div>
                            <div id="form-reader"></div>
                        <input type="submit" value="Save" class="btn btn-primary" />
                    </form>
                        <div id="form-data" style="display:none;">
                            @foreach($read_forms as $data)
                                @if($data->form_id == $form->id)
                                    @foreach($data->form as $key => $val)
                                        <div data-key="{!! $key !!}">{!! $val !!}</div>
                                    @endforeach 
                                @endif
                            @endforeach
                        </div>
                    </div>
                    @endforeach
                    @endif

                </div>
            </div>
        </div>
    </div>


</div>

@endsection
@section('script')
<script src="//cdn.ckeditor.com/4.14.1/standard/ckeditor.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.13.2/jquery-ui.min.js"></script>
<script src="{{ URL::asset('assets/form-builder/form-render.min.js') }}"></script>
<script>
    $(function() {

        var reader =   $(".row #form-content").html();
        $('#form-reader').formRender({formData: reader });

        var IDs = [];
        $("#form-data").find("div").each(function(){ 
            IDs.push($(this).data("key"));
        });

        //console.log(IDs);

        $.each(IDs, function(index, value){
            
            //console.log(value);
            
            var html = $('#form-data div[data-key="'+value+'"]').html();
            
            if(value == "image" || value == "image-1" || value == "image-2" || value == "image-3" || value == "image-4"
            || value == "image-5" || value == "image-6" || value == "image-7" || value == "image-8" || value == "image-9" 
            || value == "image-10"){
                $('#form-reader #'+value).attr('value',html); 
                $("#form-reader #"+value).after(`<a href ="`+html+`" target="_blank" class="btn btn-sm btn-dark btn-icon">
                <img src="`+html+`" width="100" height="100"></a>`);  
            }else{
                $('#form-reader #'+value).val(html); 
            }
        });


        var form_id =   $("#form_id").val();

        $.ajax({
            type: 'get',
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('token')
            },
            url: '{{ URL('admin/get-form-builder') }}',
            data: {
                'id': form_id,
            },
            success: function(data) {
                $("#form_id").val(data.id);
                $("#page_id").val(data.page_id);
                $("#section_id").val(data.section_id);
                $('#fb-reader').formRender({
                    formData: data.content
                });
                
                $('#textarea-content').addClass('ckeditor');
                //CKEDITOR.replace('textarea-content');

                CKEDITOR.replace('textarea-content', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-top-content', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                /*CKEDITOR.replace('textarea-content-1', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-content-2', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-content-3', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-content-4', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-content-5', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-content-6', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-content-7', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-content-8', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-content-9', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-content-10', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-box-1', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-box-2', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-box-3', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-box-4', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-box-5', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-box-6', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-box-7', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-box-8', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-box-9', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-box-10', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-testi-1', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-testi-2', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-testi-3', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-testi-4', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-testi-5', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-testi-6', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-testi-7', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-testi-8', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-testi-9', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});
                CKEDITOR.replace('textarea-testi-10', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});*/
                CKEDITOR.replace('textarea-btm-content', { format_tags: 'p;h1;h2;h3;h4;h5;h6;pre;address;div'});

                var IDs = [];
                $("#form-data").find("div").each(function(){ 
                    IDs.push($(this).data("key"));
                });
                $.each(IDs, function(index, value){
                    
                    var html = $('#fb-html div[data-key="'+value+'"]').html();
                    
                    if(value == "image" || value == "image-1" || value == "image-2" || value == "image-3" || value == "image-4"
            || value == "image-5" || value == "image-6" || value == "image-7" || value == "image-8" || value == "image-9" 
            || value == "image-10"){
                        $('#fb-reader #'+value).attr('value',html); 
                        $("#fb-reader #"+value).after(`<a href ="`+html+`" target="_blank" class="btn btn-sm btn-dark btn-icon">
                        <img src="`+html+`" width="100" height="100"></a>`);   
                    }else{
                        $('#fb-reader #'+value).val(html); 
                    }
                });

            }
        });
    });

</script>
@endsection