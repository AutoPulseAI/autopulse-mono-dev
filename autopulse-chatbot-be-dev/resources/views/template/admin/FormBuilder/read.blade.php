<x-layout bodyClass="g-sidenav-show  bg-gray-200">
        <x-navbars.sidebar activePage="tables"></x-navbars.sidebar>
        <main class="main-content position-relative max-height-vh-100 h-100 border-radius-lg ">
            <!-- Navbar -->
            <x-navbars.navs.auth titlePage="Read Form"></x-navbars.navs.auth>
            <!-- End Navbar -->
            <div class="container-fluid py-4">

                <div class="row">
                    <div class="col-12">
                        <div class="card my-4">
                            <div class="card-header p-0 position-relative mt-n4 mx-3 z-index-2">
                                <div class="d-flex bg-gradient-primary shadow-primary border-radius-lg pt-4 pb-3">
                                    <div class="col-6 align-items-center">
                                        <h6 class="text-white text-capitalize ps-3">Read Form</h6>
                                    </div>
                                    <div class="col-6 pe-3 text-end">
                                     
                                    </div>  
                                </div>
                            </div>

                            <div class="card-body px-0 pb-2">

                                <div class="card-body p-3">
                                    @if (session('status'))
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
                                    @if (Session::has('demo'))
                                            <div class="row">
                                                <div class="alert alert-danger alert-dismissible text-white" role="alert">
                                                    <span class="text-sm">{{ Session::get('demo') }}</span>
                                                    <button type="button" class="btn-close text-lg py-3 opacity-10"
                                                        data-bs-dismiss="alert" aria-label="Close">
                                                        <span aria-hidden="true">&times;</span>
                                                    </button>
                                                </div>
                                            </div>
                                    @endif
                                       
                                    <form method="POST" action="{{ URL('admin/save-form-transaction') }}" enctype="multipart/form-data">
                                        @csrf
                                        <input type="number" id="form_id" name="form_id" hidden/>
                                        <input type="number" id="page_id" name="page" hidden/>
                                        <input type="number" id="section_id" name="section" hidden/>

                                        <div id="fb-reader"></div>
                                        <input type="submit" value="Save" class="btn bg-gradient-dark mb-0" />
                                    </form>
                                    <div id="fb-html" style="display:none;">
                                        @foreach($read_forms as $data)
                                            @if($data->form_id == $id)
                                                @foreach($data->form as $key => $val)
                                                    <div data-key="{!! $key !!}">{!! $val !!}</div>
                                                @endforeach 
                                            @endif
                                        @endforeach
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            </div>
            <x-footers.auth></x-footers.auth>
            <script src="//cdn.ckeditor.com/4.14.1/standard/ckeditor.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.13.2/jquery-ui.min.js"></script>
            <script src="{{ URL::asset('assets/form-builder/form-render.min.js') }}"></script>
            <script>
                $(function() {
                    $.ajax({
                        type: 'get',
                        headers: {
                            'Authorization': 'Bearer ' + localStorage.getItem('token')
                        },
                        url: '{{ URL('admin/get-form-builder') }}',
                        data: {
                            'id': {{ $id }}
                        },
                        success: function(data) {
                            $("#form_id").val(data.id);
                            $("#page_id").val(data.page_id);
                            $("#section_id").val(data.section_id);
                            $('#fb-reader').formRender({
                                formData: data.content
                            });
                            
                            $('#textarea-content').addClass('ckeditor');
                            CKEDITOR.replace('textarea-content');
                            CKEDITOR.replace('textarea-timing-content');
                            CKEDITOR.replace('textarea-box-1');
                            CKEDITOR.replace('textarea-box-2');
                            CKEDITOR.replace('textarea-box-3');
                            CKEDITOR.replace('textarea-box-4');
                            CKEDITOR.replace('textarea-box-5');
                            CKEDITOR.replace('textarea-box-6');
                            CKEDITOR.replace('textarea-box-7');
                            CKEDITOR.replace('textarea-get-us');
                            CKEDITOR.replace('textarea');

                            var IDs = [];
                            $("#fb-html").find("div").each(function(){ 
                                IDs.push($(this).data("key"));
                            });

                            $.each(IDs, function(index, value){
                                
                                var html = $('#fb-html div[data-key="'+value+'"]').html();
                                
                                if(value == "file-image"){
                                    $('#fb-reader #'+value).attr('value',html); console.log(value)   
                                    $("#fb-reader #"+value).after(`<a href ="{{url('/')}}/`+html+`" class="btn btn-dark" target="_blank">Image</a>`);  
                                }else{
                                    $('#fb-reader #'+value).val(html); 
                                }
                            });

                        }
                    });
                });

            </script>
        </div>
    </main>
    <x-plugins></x-plugins>
    

</x-layout>
