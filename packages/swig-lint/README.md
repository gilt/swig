# swig-lint
Swig task that checks for possible issues in your code base.

## Usage
Meant to be used via the [Swig CLI][1], just run:

```
swig lint
```

You can also instruct the CSS linter to use a different engine (default is an ancient version
of [Lesshint][2]), namely [Stylelint][3], like so:

```
swig lint --use-stylelint
```

You can also instruct the linter to look at a specific source folder

```
swig lint --src /web/web-blah/target
```

In this case you shall provide the linter a `.stylelintrc.yml` file with the necessary Stylelint
configuration.

By using [Stylelint][3] you can now also specify files to ignore (previously not possible), using the
special `.stylelintignore` config file, which uses a `.gitignore`-like syntax.


## TODO

 - Add more helpful information on the README (like list of JS/CSS rules) and
 how to override them.


[1]:https://www.npmjs.com/package/@gilt-tech/swig
[2]:https://github.com/gilt/lesshint
[3]:https://stylelint.io/
