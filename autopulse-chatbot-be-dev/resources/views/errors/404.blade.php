<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 Not Found</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-EVSTQN3/azprG1Anm3QDgpJLIm9Nao0Yz1ztcQTwFspd3yD65VohhpuuCOmLASjC" crossorigin="anonymous">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Mulish:ital,wght@0,200..1000;1,200..1000&display=swap');
        :root {
            --primary: #FF4605;
            --primary-light: #FFF0EB;
            --black: #0F141E;
            --dark: #222732;
            --dark-light: #2F3B48;
            --secondary: #99A1B2;
            --gray: #EFF3FA;
            --white: #ffffff;
            --border-color: rgba(52, 59, 74, 0.05);
            --red: #ff0000;
            --green: #198754;
            --card-icons: #a7a7a7;
            --tw: #1fbed6;
            --fb: #1877F2;
            --yb: #CD201F;
            --ln: #0077b5;
            --wh: #25d366;

            --brown: #964B00;
        }

        html{
            height: 100%;
        }

        body {
            font-family: "Mulish", sans-serif;
            margin: 0;
            padding: 0;
            color: var(--dark-light);
            font-size: 17px;
            height: 100%;
        }

        /* 404 */
        .error_page{
            position: relative;
            height: 100%;
        }
        .error_page .error_content{
            position: relative;
        }
        .error_page .error_content h2{
            position: relative;
            font-size: 400px;
            color: var(--secondary);
            margin: 0;
            font-weight: 800;
            z-index: 1;
            opacity: .9;
        }
        .error_page .error_content img{
            margin-top: -120px;
        }
        .error_page .error_content h3{
            font-size: 60px;
            margin-bottom: 30px;
            font-weight: 800;
            color: var(--primary);
        }
        .error_page .error_content h5{
            font-style: italic;
            font-size: 24px;
            display: block;
            margin: 30px 0;
            color: var(--black)
        }
        .error_page .error_content p a{
            font-weight: 600;
            color: var(--primary);
            text-decoration: unset;
        }

        @media (max-width: 1500px){
            .error_page .error_content h2{
                font-size: 300px;
                line-height: 300px;
            }
            .error_page .error_content img{
                width: 70%;
            }
            .error_page .error_content h3{
                font-size: 46px;
            }
            .error_page .error_content h5{
                font-size: 22px;
                margin: 20px 0;
            }
        }
        @media (max-width: 1024px) {
            .error_page .error_content h2 {
                font-size: 240px;
            }
            .error_page .error_content h3 {
                margin-bottom: 20px;
            }
        }
        @media (max-width: 991px) {
            .error_page{
                display: flex;
                align-items: center;
                height: 100%
            }
            .error_page .error_content img {
                width: 100%;
                margin-top: -100px;
            }
        }
        @media (max-width: 600px) {
            .error_page .error_content h2 {
                font-size: 120px;
                line-height: 240px;
            }
            .error_page .error_content h3 {
                font-size: 30px;
            }
            .error_page .error_content h5 {
                font-size: 20px;
                margin: 16px 0;
            }
            .error_page .error_content p {
                font-size: 14px;
            }
        }
    </style>
</head>
<body>

<section class="error_page">
    <div class="container">
        <div class="col col-12">
            <div class="error_content text-center">
                <h2>404</h2>
                <img src="http://3.109.192.246/assets/images/errorimg.jpg" alt="404">
                <h3>Ooopps...</h3>
                <h5><strong>The page you were looking for, couldn't be found.</strong></h5>
                <p>Can't find what you looking for? start from our <a class="link" href="{{ url('/') }}">Home Page</a></p>
            </div>
        </div>
    </div>
</section>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.0.2/dist/js/bootstrap.bundle.min.js" integrity="sha384-MrcW6ZMFYlzcLA8Nl+NtUVF0sA7MsXsP1UyJoMp4YLEuNSfAP+JcXn/tWtIaxVXM" crossorigin="anonymous"></script>

</body>
</html>
